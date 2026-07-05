import type { Request, Response } from "express";

export interface SseConnection {
  send: (event: string, data: unknown) => void;
  close: () => void;
}

export function createSseConnection(req: Request, res: Response): SseConnection {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const close = () => {
    res.end();
  };

  req.on("close", close);

  return { send, close };
}
