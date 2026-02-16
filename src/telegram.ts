import axios from 'axios';
import { TelegramConfig } from './config.js';

export async function sendTelegramMessage(config: TelegramConfig | undefined, text: string): Promise<boolean> {
  if (!config?.enabled || !config.botToken || !config.chatId) {
    return false;
  }

  try {
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

    const response = await axios.post(url, payload, { timeout: 10000 });
    return response.status === 200 && response.data?.ok === true;
  } catch (error: any) {
    console.error(`[Telegram] Error sending message: ${error.message}`);
    return false;
  }
}
