/** dsh-ee 标志：喷水的胖鲸鱼，单色，颜色取 currentColor。 */
export function WhaleMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M23 14.8c0 3.6-3 6.2-7.2 6.2H9.8c-3.4 0-5.6-2-5.9-5.1l-.3-4.6C2.5 10.9 1.4 9.9 1 8.4c1.6.2 2.8.7 3.5 1.7.7-1 1.9-1.5 3.5-1.7-.4 1.5-1.5 2.5-2.6 2.9l.1 1.4c.4 1.4 1.3 2.1 2.6 2.1C9.2 11.3 12.1 8.9 15.7 8.9c4.4 0 7.3 2.5 7.3 5.9Zm-3.3-.9a1.15 1.15 0 1 0-2.3 0 1.15 1.15 0 0 0 2.3 0Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        d="M15.8 7.8V6m0 0c-.3-1.5-1.4-2.2-2.7-2m2.7 2c.3-1.5 1.4-2.2 2.7-2"
      />
    </svg>
  );
}
