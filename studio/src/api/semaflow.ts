import { config } from '@/config/runtime';

export class SemaflowAPI {
  private static readonly BASE_URL = config.semaflowUrl;

  /**
   * Generates a BPMN 2.0 XML string from a natural language prompt.
   * Calls the Semaflow backend service.
   */
  static async generateBPMN(prompt: string): Promise<string> {
    const res = await fetch(`${this.BASE_URL}/generate-bpmn`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ prompt })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Semaflow Generation failed: ${res.statusText} - ${text}`);
    }

    return res.text(); // Endpoint returns raw XML
  }
}
