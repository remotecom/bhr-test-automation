import { runPlayground } from "@/src/dashboard/playground";

export const maxDuration = 60;

export async function POST(request: Request) {
  const config = await request.json();

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      const broadcast = (event: string, data: unknown) => {
        const chunk = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      };

      try {
        await runPlayground(config, broadcast);
      } catch {
        // Error already broadcast via playground:error inside runPlayground
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
