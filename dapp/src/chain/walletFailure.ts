// Turning what a wallet throws into something a person can act on.
// A wallet can fail in three different ways and they need different answers, so
// a refusal is told apart from a connection that died. Anything else is shown as
// it came, and always written to the console, because a sentence on screen is
// not enough to debug a wallet.
export const explainWalletFailure = (
  failure: unknown,
  what: string
): string => {
  const message = String((failure as any)?.message ?? failure ?? '');

  console.error('mvxvest wallet failure:', failure);
  if (
    /user\s*(rejected|denied|cancel)|rejected by user|action_rejected|cancelled by user/i.test(
      message
    )
  )
    return 'You refused it in your wallet, nothing was sent.';
  if (
    /timeout|timed out|failed to fetch|network ?error|socket hang up/i.test(
      message
    )
  )
    return `${what} may still have gone through: the network's answer was lost. The page reads the chain again by itself; check it before trying again.`;
  if (
    /session|topic|relay|connection closed|disconnected|no matching key|expired/i.test(
      message
    )
  )
    return 'The connection to your wallet was lost. Disconnect with the door icon at the top, connect again and try once more.';
  if (!message)
    return `${what} did not go through. The wallet gave no reason. Try again.`;
  return `${what} did not go through: ${message.slice(0, 200)}`;
};
