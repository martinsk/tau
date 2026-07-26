use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

#[tauri::command]
pub fn create_terminal(
    id: String,
    cwd: String,
    shell: Option<String>,
    state: tauri::State<'_, PtyManager>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state.create(id, cwd, shell, app)
}

#[tauri::command]
pub fn terminal_input(
    id: String,
    data: String,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    state.write(id, data)
}

#[tauri::command]
pub fn terminal_resize(
    id: String,
    cols: u16,
    rows: u16,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    state.resize(id, cols, rows)
}

#[tauri::command]
pub fn kill_terminal(
    id: String,
    state: tauri::State<'_, PtyManager>,
) -> Result<(), String> {
    state.kill(id)
}

/// Abstraction over process spawning so the PTY manager can be tested without
/// launching real shells.
pub trait ProcessBackend: Send + Sync {
    fn spawn(&self, shell: &str, cwd: &str) -> Result<SpawnedProcess, String>;
}

pub struct SpawnedProcess {
    pub reader: Box<dyn Read + Send>,
    pub session: Arc<Mutex<dyn ProcessSession + Send>>,
}

pub trait ProcessSession: Send {
    fn write(&mut self, data: &[u8]) -> io::Result<()>;
    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String>;
    fn kill(&mut self) -> Result<(), String>;
}

pub struct NativePtyBackend;

impl ProcessBackend for NativePtyBackend {
    fn spawn(&self, shell: &str, cwd: &str) -> Result<SpawnedProcess, String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let mut cmd = CommandBuilder::new(shell);
        cmd.cwd(cwd);
        let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;

        let reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|e| e.to_string())?,
        ));

        let session: Arc<Mutex<dyn ProcessSession + Send>> =
            Arc::new(Mutex::new(NativeProcessSession {
                _pair: pair,
                _child: child,
                writer,
            }));

        Ok(SpawnedProcess { reader, session })
    }
}

struct NativeProcessSession {
    _pair: PtyPair,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
    writer: Arc<Mutex<dyn Write + Send>>,
}

impl ProcessSession for NativeProcessSession {
    fn write(&mut self, data: &[u8]) -> io::Result<()> {
        let mut writer = self.writer.lock().unwrap();
        writer.write_all(data)?;
        writer.flush()
    }

    fn resize(&mut self, cols: u16, rows: u16) -> Result<(), String> {
        self._pair
            .master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    fn kill(&mut self) -> Result<(), String> {
        self._child.kill().map_err(|e| e.to_string())
    }
}

pub struct PtyManager {
    backend: Arc<dyn ProcessBackend>,
    sessions: Mutex<HashMap<String, Arc<Mutex<dyn ProcessSession + Send>>>>,
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new(Arc::new(NativePtyBackend))
    }
}

impl PtyManager {
    pub fn new(backend: Arc<dyn ProcessBackend>) -> Self {
        Self {
            backend,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        id: String,
        cwd: String,
        shell: Option<String>,
        app: tauri::AppHandle,
    ) -> Result<(), String> {
        {
            let sessions = self.sessions.lock().unwrap();
            if sessions.contains_key(&id) {
                return Err("terminal already exists".into());
            }
        }

        let shell = shell.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "sh".into()));
        let spawned = self.backend.spawn(&shell, &cwd)?;
        let mut reader = spawned.reader;
        let session_id = id.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(
                            "terminal-output",
                            TerminalOutput {
                                id: session_id.clone(),
                                data,
                            },
                        );
                    }
                    Err(_) => break,
                }
            }
        });

        self.sessions.lock().unwrap().insert(id, spawned.session);
        Ok(())
    }

    pub fn write(&self, id: String, data: String) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("terminal not found")?;
        session
            .lock()
            .unwrap()
            .write(data.as_bytes())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("terminal not found")?;
        session.lock().unwrap().resize(cols, rows)
    }

    pub fn kill(&self, id: String) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let session = sessions.remove(&id).ok_or("terminal not found")?;
        session.lock().unwrap().kill()
    }
}

#[derive(Clone, serde::Serialize)]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    struct FakeProcessSession {
        input: Arc<Mutex<Vec<u8>>>,
        killed: Arc<Mutex<bool>>,
    }

    impl ProcessSession for FakeProcessSession {
        fn write(&mut self, data: &[u8]) -> io::Result<()> {
            self.input.lock().unwrap().extend_from_slice(data);
            Ok(())
        }

        fn resize(&mut self, _cols: u16, _rows: u16) -> Result<(), String> {
            Ok(())
        }

        fn kill(&mut self) -> Result<(), String> {
            *self.killed.lock().unwrap() = true;
            Ok(())
        }
    }

    struct ChannelReader {
        rx: std::sync::mpsc::Receiver<Vec<u8>>,
        pending: Vec<u8>,
        pos: usize,
    }

    impl Read for ChannelReader {
        fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
            if self.pos < self.pending.len() {
                let n = self.pending.len().min(buf.len());
                buf[..n].copy_from_slice(&self.pending[self.pos..self.pos + n]);
                self.pos += n;
                if self.pos == self.pending.len() {
                    self.pending.clear();
                    self.pos = 0;
                }
                return Ok(n);
            }
            match self.rx.recv() {
                Ok(data) => {
                    self.pending = data;
                    self.pos = 0;
                    self.read(buf)
                }
                Err(_) => Ok(0),
            }
        }
    }

    struct FakeProcessBackend {
        rx: Mutex<Option<std::sync::mpsc::Receiver<Vec<u8>>>>,
        input: Arc<Mutex<Vec<u8>>>,
        killed: Arc<Mutex<bool>>,
    }

    impl FakeProcessBackend {
        fn new() -> (Self, FakeProcessHandle) {
            let (tx, rx) = std::sync::mpsc::channel();
            let input = Arc::new(Mutex::new(Vec::new()));
            let killed = Arc::new(Mutex::new(false));
            let handle = FakeProcessHandle {
                tx,
                input: input.clone(),
            };
            (
                Self {
                    rx: Mutex::new(Some(rx)),
                    input,
                    killed,
                },
                handle,
            )
        }
    }

    impl ProcessBackend for FakeProcessBackend {
        fn spawn(&self, _shell: &str, _cwd: &str) -> Result<SpawnedProcess, String> {
            let rx = self
                .rx
                .lock()
                .unwrap()
                .take()
                .ok_or("fake backend already spawned")?;
            let reader = Box::new(ChannelReader {
                rx,
                pending: Vec::new(),
                pos: 0,
            });
            let session: Arc<Mutex<dyn ProcessSession + Send>> = Arc::new(Mutex::new(
                FakeProcessSession {
                    input: self.input.clone(),
                    killed: self.killed.clone(),
                },
            ));
            Ok(SpawnedProcess { reader, session })
        }
    }

    struct FakeProcessHandle {
        tx: std::sync::mpsc::Sender<Vec<u8>>,
        input: Arc<Mutex<Vec<u8>>>,
    }

    impl FakeProcessHandle {
        fn send_output(&self, data: &[u8]) {
            let _ = self.tx.send(data.to_vec());
        }

        fn input(&self) -> Vec<u8> {
            self.input.lock().unwrap().clone()
        }
    }

    #[test]
    fn fake_backend_records_input_and_output() {
        let (backend, handle) = FakeProcessBackend::new();
        let spawned = backend.spawn("sh", "/").unwrap();

        spawned
            .session
            .lock()
            .unwrap()
            .write(b"hello")
            .unwrap();
        assert_eq!(handle.input(), b"hello");

        handle.send_output(b"world");
        let mut reader = spawned.reader;
        let mut buf = [0u8; 16];
        let n = reader.read(&mut buf).unwrap();
        assert_eq!(&buf[..n], b"world");
    }
}
