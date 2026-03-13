import { DurableObject } from "cloudflare:workers";
import type { ApprovalResponse } from "@dispatch/shared";

interface PendingApproval {
  resolve: (response: ApprovalResponse) => void;
  timer: number;
}

export class SessionDO extends DurableObject {
  private pending = new Map<string, PendingApproval>();

  async createApproval(requestId: string): Promise<void> {
    // Just register — the long-poll will create the promise
  }

  async pollApproval(requestId: string, timeoutMs = 30000): Promise<ApprovalResponse> {
    // If already resolved before polling started, check storage
    const stored = await this.ctx.storage.get<ApprovalResponse>(`result:${requestId}`);
    if (stored) {
      await this.ctx.storage.delete(`result:${requestId}`);
      return stored;
    }

    return new Promise<ApprovalResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        // Don't resolve with deny on poll timeout — let the hook retry
        resolve({ decision: "deny", message: "Poll timeout — retrying" });
      }, timeoutMs) as unknown as number;

      this.pending.set(requestId, { resolve, timer });
    });
  }

  async resolveApproval(requestId: string, response: ApprovalResponse): Promise<void> {
    const entry = this.pending.get(requestId);
    if (entry) {
      clearTimeout(entry.timer);
      entry.resolve(response);
      this.pending.delete(requestId);
    } else {
      // Poll hasn't started yet or already timed out — store for next poll
      await this.ctx.storage.put(`result:${requestId}`, response);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    // /approval/poll/:requestId
    // /approval/respond/:requestId
    // /approval/request/:requestId

    if (parts[0] === "approval") {
      const action = parts[1];
      const requestId = parts[2];

      if (action === "request" && request.method === "POST") {
        await this.createApproval(requestId);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      if (action === "poll" && request.method === "GET") {
        const timeout = parseInt(url.searchParams.get("timeout") || "30000");
        const result = await this.pollApproval(requestId, timeout);
        return new Response(JSON.stringify(result), {
          headers: { "Content-Type": "application/json" },
        });
      }

      if (action === "respond" && request.method === "POST") {
        const body = (await request.json()) as ApprovalResponse;
        await this.resolveApproval(requestId, body);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
    }

    return new Response("Not found", { status: 404 });
  }
}
