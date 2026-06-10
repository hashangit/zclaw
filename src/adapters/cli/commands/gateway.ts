/**
 * ZClaw CLI — /gateway slash command
 *
 * Management commands for the gateway subsystem.
 */

export function createGatewayCommandHandler(): (args: string) => Promise<string> {
  return async (args: string): Promise<string> => {
    const parts = args.trim().split(/\s+/);
    const subcommand = parts[0] ?? 'help';

    switch (subcommand) {
      case 'help':
        return 'Gateway management commands:\n  /gateway list - List targets\n  /gateway add - Add target\n  /gateway remove <name> - Remove target\n  /gateway toggle <name> - Toggle target\n  /gateway routes - Manage routes\n  /gateway credentials - Manage credentials';
      case 'list':
        return 'Gateway: No targets registered (gateway not yet wired to CLI Agent)';
      default:
        return `Unknown gateway subcommand: ${subcommand}. Type /gateway help for available commands.`;
    }
  };
}
