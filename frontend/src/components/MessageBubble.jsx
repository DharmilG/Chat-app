function formatMessageTime(timestamp) {
  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp)
}

function MessageBubble({ chatMessage }) {
  const isOwn = chatMessage.isOwn

  return (
    <article className={`message-bubble ${isOwn ? 'message-bubble-own' : ''}`}>
      <div className="message-meta">
        <strong>{isOwn ? 'You' : chatMessage.displayName}</strong>
        <time dateTime={new Date(chatMessage.timestamp).toISOString()}>
          {formatMessageTime(chatMessage.timestamp)}
        </time>
      </div>
      <p>{chatMessage.message}</p>
    </article>
  )
}

export default MessageBubble
