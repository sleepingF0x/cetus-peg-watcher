import axios from 'axios';
import { ResolvedTelegramConfig } from './config.js';
import { createModuleLogger, toLogError } from './logger.js';

const log = createModuleLogger('Telegram');
const MAX_RETRIES = 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendTelegramMessage(
  config: ResolvedTelegramConfig | undefined,
  text: string,
): Promise<boolean> {
  if (!config?.enabled || !config.botToken || !config.chatId) {
    return false;
  }

  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;
  const payload: {
    chat_id: string;
    text: string;
    parse_mode: 'HTML';
    disable_web_page_preview: boolean;
    message_thread_id?: number;
  } = {
    chat_id: config.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };

  if (config.messageThreadId) {
    payload.message_thread_id = config.messageThreadId;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await axios.post(url, payload, { timeout: 10000 });
      return response.status === 200 && response.data?.ok === true;
    } catch (error: unknown) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;

        // Retry on 429 (rate-limit) and 5xx (server errors)
        if (attempt < MAX_RETRIES && status && (status === 429 || status >= 500)) {
          const retryAfterSec = status === 429
            ? Number(error.response?.headers['retry-after'] ?? 5)
            : 2 * (attempt + 1);
          log.warn(
            { event: 'telegram_retry', status, attempt: attempt + 1, retryAfterSec },
            'Retrying Telegram send after rate-limit/server error',
          );
          await delay(retryAfterSec * 1000);
          continue;
        }

        const responseData = error.response?.data;
        const detail = responseData === undefined
          ? error.message
          : typeof responseData === 'string'
            ? responseData
            : JSON.stringify(responseData);

        log.error(
          { event: 'telegram_send_failed', status, detail, err: toLogError(error) },
          'Error sending Telegram message',
        );
      } else {
        log.error(
          { event: 'telegram_send_failed', err: toLogError(error) },
          'Error sending Telegram message',
        );
      }
      return false;
    }
  }

  return false;
}
