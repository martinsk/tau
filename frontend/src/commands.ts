/**
 * Central command registry. Any action in the app (menu item, button,
 * keybinding, or command-palette entry) should be registered here once so
 * it can be discovered, searched, and bound to different keymaps.
 */
export interface Command {
  id: string;
  title: string;
  category?: string;
  enabled?: () => boolean;
  visible?: () => boolean;
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();
let errorHandler: (command: Command, error: unknown) => void = (command, error) => {
  console.error(`Command "${command.id}" failed:`, error);
};

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
  return Array.from(registry.values()).filter((command) => command.visible?.() !== false);
}

export function isCommandEnabled(command: Command): boolean {
  return command.enabled?.() !== false;
}

export function setCommandErrorHandler(
  handler: (command: Command, error: unknown) => void
): void {
  errorHandler = handler;
}

/**
 * Runs the command with the given id, if registered. Returns whether a
 * matching enabled command was found and invoked.
 */
export async function runCommand(id: string): Promise<boolean> {
  const command = registry.get(id);
  if (!command || command.visible?.() === false || !isCommandEnabled(command)) return false;
  try {
    await command.run();
    return true;
  } catch (error) {
    errorHandler(command, error);
    return false;
  }
}
