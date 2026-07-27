/**
 * Central command registry. Any action in the app (menu item, button,
 * keybinding, or command-palette entry) should be registered here once so
 * it can be discovered, searched, and bound to different keymaps.
 */
export interface Command {
  id: string;
  title: string;
  category?: string;
  run: () => void;
}

const registry = new Map<string, Command>();

export function registerCommand(command: Command): void {
  registry.set(command.id, command);
}

export function registerCommands(commands: Command[]): void {
  for (const command of commands) registerCommand(command);
}

export function unregisterCommand(id: string): void {
  registry.delete(id);
}

export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

export function getCommands(): Command[] {
  return Array.from(registry.values());
}

/**
 * Runs the command with the given id, if registered. Returns whether a
 * matching command was found and invoked.
 */
export function runCommand(id: string): boolean {
  const command = registry.get(id);
  if (!command) return false;
  command.run();
  return true;
}
