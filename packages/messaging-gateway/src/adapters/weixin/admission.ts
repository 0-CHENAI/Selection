// A WeChat poll processes inbound messages in order. Once the session manager
// has persisted the message, later messages can be admitted during model work.
export async function waitForWeixinAdmission(
  dispatch: (acknowledge: () => void) => Promise<void>,
  onLateFailure: (error: unknown) => void | Promise<void>,
): Promise<void> {
  let accepted = false
  const admitted = Promise.withResolvers<void>()
  const execution = dispatch(() => {
    accepted = true
    admitted.resolve()
  }).catch(error => {
    if (!accepted) throw error
    return onLateFailure(error)
  })
  await Promise.race([admitted.promise, execution])
}
