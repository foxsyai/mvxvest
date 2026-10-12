// The mark: the FOXSY fox head of mvxsafe.io, filled orange, with the vesting
// key inside in ink (where mvxsafe has its check). Same shape and colours as
// public/mvxvest-icon.svg. Inline so it never flashes while loading.
export const Logo = () => (
  <span className='flex items-center gap-2.5'>
    <svg width='30' height='30' viewBox='0 0 512 512' fill='none' aria-hidden>
      <path
        d='M 84 24 L 180 160 L 332 160 L 428 24 L 472 300 L 256 492 L 40 300 Z'
        fill='#FF6E0A'
        stroke='#FF6E0A'
        strokeWidth='18'
        strokeLinejoin='round'
      />
      <g
        transform='translate(250 290) scale(5.6) translate(-30 -31)'
        stroke='#09090D'
        strokeWidth='7'
        strokeLinecap='round'
        strokeLinejoin='round'
      >
        <circle cx='24' cy='25' r='8.5' />
        <path d='M30 31l13 13M39.5 40.5l4-4M35.5 36.5l3-3' />
      </g>
    </svg>
    <span className='text-lg font-bold tracking-tight max-[360px]:hidden'>
      mvxvest
    </span>
  </span>
);
