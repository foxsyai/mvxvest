// The mark: a key on teal, the same key as the claim key NFT. Inline so it
// never flashes while loading.
export const Logo = () => (
  <span className='flex items-center gap-2.5'>
    <svg width='28' height='28' viewBox='0 0 64 64' aria-hidden>
      <rect width='64' height='64' rx='14' className='fill-accent' />
      <g
        fill='none'
        strokeWidth='5.5'
        strokeLinecap='round'
        strokeLinejoin='round'
        className='stroke-accent-ink'
      >
        <circle cx='24' cy='25' r='9' />
        <path d='M31 32l14 14M41 42l4-4M37 38l3-3' />
      </g>
    </svg>
    <span className='text-lg font-bold tracking-tight max-[360px]:hidden'>
      mvxvest
    </span>
  </span>
);
