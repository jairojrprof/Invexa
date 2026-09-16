// Mensagens do usuário, do histórico e da IA devem ser exibidas como texto.
export function appendChatMessage(container, message) {
  const document = container.ownerDocument
  const row = document.createElement('div')
  row.className = `chat-msg ${message.role === 'user' ? 'chat-user' : 'chat-ai'}`
  const bubble = document.createElement('div')
  bubble.className = 'chat-bubble'
  bubble.style.whiteSpace = 'pre-wrap'
  bubble.textContent = String(message.conteudo ?? '')
  row.appendChild(bubble)
  container.appendChild(row)
}
