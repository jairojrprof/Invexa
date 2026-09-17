// O callback de Auth só agenda trabalho: consultas Supabase executam fora do lock de Auth.
export function startAuthLifecycle(sb, { onSession, onSignedOut, onError }, schedule = task => setTimeout(task, 0)) {
  let currentId, revision = 0
  function accept(session) {
    const id = session?.user?.id || null
    if (id === currentId) return
    currentId = id
    const version = ++revision
    schedule(() => {
      if (version !== revision) return
      Promise.resolve().then(() => session ? onSession(session) : onSignedOut()).catch(onError)
    })
  }
  let eventReceived = false
  const subscription = sb.auth.onAuthStateChange((_event, session) => {
    eventReceived = true
    accept(session)
  })
  // INITIAL_SESSION pode chegar antes ou depois dessa consulta. A identidade deduplica ambos.
  sb.auth.getSession().then(({ data, error }) => {
    if (error) throw error
    if (!eventReceived) accept(data?.session)
  }).catch(onError)
  return subscription
}
