# Chapter 2: The LLM Transport Layer

This is the bottom layer — the one that actually talks to LLM providers. By the end of this chapter, you'll have built a working streaming LLM client with a normalized event protocol. This is what `pi-ai` does.

## Lessons

1. **[LLM APIs 101](./01-llm-apis-101.md)** — Messages, content blocks, the request/response shape
2. **[Streaming](./02-streaming.md)** — Why streaming matters, SSE, async iterators
3. **[The event protocol](./03-the-event-protocol.md)** — Why normalized events; the design of `AssistantMessageEvent`
4. **[Building the transport](./04-building-the-transport.md)** — Implement it, with code

## Examples

- `examples/01-non-streaming.ts` — minimal Anthropic call
- `examples/02-streaming-raw.ts` — raw SDK streaming
- `examples/03-normalized-events.ts` — your first normalized stream

## Time estimate

~90 minutes total.

## What you'll know by the end

- How LLM APIs structure messages and tool calls
- How streaming works (SSE under the hood, async iterators on top)
- Why a normalized event protocol is the most important design choice in transport
- How to write a wrapper that turns any provider into your protocol

## Why this chapter matters

The transport layer is the **foundation** the rest of the agent sits on. A clean event protocol here makes the agent loop in Chapter 4 trivial. A messy one makes it impossible. Everything downstream is shaped by what you decide here.
