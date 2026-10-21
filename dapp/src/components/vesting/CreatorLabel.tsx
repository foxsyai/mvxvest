/**
 * A vesting's label: whoever created the vesting wrote it (up to 64 bytes),
 * so it is quoted and marked as theirs and never reads as the site's own
 * words (fourth audit, WEB-9). bdi keeps right-to-left text from reordering
 * what follows it.
 */
export const CreatorLabel = ({ text }: { text: string }) => (
  <span title="The creator's label: their words, not mvxvest's">
    “<bdi>{text}</bdi>”
  </span>
);
