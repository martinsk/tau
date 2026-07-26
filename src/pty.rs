use portable_pty::{native_pty_system, CommandBuilder, PtyPair, PtySize};
use std::collections::HashMap;
use std::io::Read;
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

pub struct PtySession {
    _pair: PtyPair,
    writer: Arc<Mutex<dyn std::io::Write + Send>>,
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
}

impl PtyManager {
    pub fn create(
        &self,
        id: String,
        cwd: String,
        shell: Option<String>,
        app: tauri::AppHandle,
    ) -> Result<(), String> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())?;

        let shell = shell.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "sh".into()));
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(cwd);
        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| e.to_string())?;

        let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
        let writer = Arc::new(Mutex::new(
            pair.master.take_writer().map_err(|e| e.to_string())?,
        ));

        {
            let sessions = self.sessions.lock().unwrap();
            if sessions.contains_key(&id) {
                return Err("terminal already exists".into());
            }
        }

        let session_id = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit("terminal-output", TerminalOutput { id: session_id.clone(), data });
                    }
                    Err(_) => break,
                }
            }
        });

        let session = PtySession {
            _pair: pair,
            writer,
            _child: child,
        };

        self.sessions.lock().unwrap().insert(id, session);
        Ok(())
    }

    pub fn write(&self, id: String, data: String) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("terminal not found")?;
        let mut writer = session.writer.lock().unwrap();
        writer
            .write_all(data.as_bytes())
            .and_then(|_| writer.flush())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&self, id: String, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        let session = sessions.get(&id).ok_or("terminal not found")?;
        session
            ._pair
            .master
            .resize(PtySize {
                cols,
                rows,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    }

    pub fn kill(&self, id: String) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        let mut session = sessions.remove(&id).ok_or("terminal not found")?;
        let _ = session._child.kill();
        Ok(())
    }
}

#[derive(Clone, serde::Serialize)]
pub struct TerminalOutput {
    pub id: String,
    pub data: String,
}
