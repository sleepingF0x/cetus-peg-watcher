import axios from 'axios';

export async function sendBarkAlert(barkUrl: string, title: string, message: string): Promise<boolean> {
  try {
    const url = `${barkUrl}/${encodeURIComponent(title)}/${encodeURIComponent(message)}?call=1&level=critical`;
    const response = await axios.get(url, { timeout: 10000 });
    
    if (response.status === 200) {
      console.log(`[Bark] Notification sent successfully: ${title}`);
      return true;
    } else {
      console.error(`[Bark] Failed to send notification. Status: ${response.status}`);
      return false;
    }
  } catch (error: any) {
    console.error(`[Bark] Error sending notification: ${error.message}`);
    return false;
  }
}
