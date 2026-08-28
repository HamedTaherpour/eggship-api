/**
 * Customer cancellation has no client-controlled fields. Keeping an explicit
 * empty DTO makes the global whitelist/forbidNonWhitelisted validation reject
 * attempts to smuggle status, actor, reason, or release data into the command.
 */
export class CancelOrderBodyDto {}
