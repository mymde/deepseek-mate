// OpenAI-compatible streaming mock used only for end-to-end UI tests (no real model).
// "跳舞" in the user's message -> a pet_action(dance) tool call, then a text reply.
import { createServer } from 'node:http'
const port = Number(process.argv[2] ?? 18790)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const REPLY = '你好呀！我是希可儿，住在你的 Harness 输入框上。有什么想聊的，或者需要我帮忙的事情吗？'
const AFTER_TOOL = '跳完啦～这支舞送给你，今天也要开心哦！'
createServer(async (req, res) => {
  if (req.method === 'GET' && req.url.endsWith('/models')) {
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-chat', object: 'model' }] }))
  }
  let body = ''
  for await (const c of req) body += c
  const json = JSON.parse(body || '{}')
  const msgs = json.messages ?? []
  console.log(
    'request tools:',
    (json.tools ?? [])
      .map((t) => t.function?.name)
      .filter((n) => /^pet_/.test(n))
      .join(',') || '(no pet tools)',
    'total',
    (json.tools ?? []).length
  )
  const last = msgs[msgs.length - 1] ?? {}
  const userText = [...msgs].reverse().find((m) => m.role === 'user')
  const text = typeof userText?.content === 'string' ? userText.content : JSON.stringify(userText?.content ?? '')
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  const send = (delta, finish = null) =>
    res.write(
      `data: ${JSON.stringify({ id: 'mock', object: 'chat.completion.chunk', created: 0, model: 'mock-chat', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
    )
  send({ role: 'assistant' })
  if (last.role !== 'tool' && /跳.?舞|dance/.test(text) && json.tools?.some((t) => t.function?.name === 'pet_action')) {
    send({
      tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'pet_action', arguments: '' } }]
    })
    for (const part of ['{"name":', '"dance"}']) {
      await sleep(60)
      send({ tool_calls: [{ index: 0, function: { arguments: part } }] })
    }
    send({}, 'tool_calls')
  } else {
    const reply = last.role === 'tool' ? AFTER_TOOL : REPLY
    const chars = Array.from(reply)
    for (let i = 0; i < chars.length; i += 2) {
      await sleep(70)
      send({ content: chars.slice(i, i + 2).join('') })
    }
    send({}, 'stop')
  }
  res.write('data: [DONE]\n\n')
  res.end()
}).listen(port, '127.0.0.1', () => console.log(`mock llm on http://127.0.0.1:${port}/v1`))
