import * as https from "https";
import { URL } from "url";
import { ApiError } from "./types";
import { AuthLike } from "./SheetsClient";

const DEFAULT_ENDPOINT = "https://www.googleapis.com/drive/v3/files";

export class DriveClient {
  constructor(private auth: AuthLike, private endpoint: string = DEFAULT_ENDPOINT) {}

  async getModifiedTime(fileId: string): Promise<string> {
    const token = await this.auth.getAccessToken();
    const url = `${this.endpoint}/${encodeURIComponent(fileId)}?fields=modifiedTime`;
    const data = await this.get(url, token);
    return data.modifiedTime as string;
  }

  private get(url: string, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const u = new URL(url);
      const req = https.request(
        {
          method: "GET",
          hostname: u.hostname,
          path: u.pathname + u.search,
          headers: { Authorization: `Bearer ${token}` },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            const status = res.statusCode ?? 0;
            let parsed: any = null;
            try { parsed = JSON.parse(body); } catch {}
            if (status >= 200 && status < 300) {
              resolve(parsed);
            } else {
              reject(new ApiError(status, parsed?.error?.status ?? `HTTP_${status}`, parsed?.error?.message ?? body));
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
}
