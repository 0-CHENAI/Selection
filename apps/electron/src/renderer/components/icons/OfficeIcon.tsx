import type { SVGProps } from 'react'

/**
 * Sidebar mark for the whole Office area: a document, a sheet, and a slide.
 * Same 24px grid, stroke width, and currentColor as the Lucide icons beside it.
 */
export function OfficeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="2" y="6.25" width="8.6" height="14.5" rx="1.5" />
      <path d="M4.2 10.6h4.2M4.2 14.2h4.2" />
      <rect x="13.6" y="2.4" width="8.2" height="7.6" rx="1.5" />
      <path d="M13.6 6.2h8.2M17.7 2.4v7.6" />
      <rect x="13.6" y="13.2" width="8.2" height="5.3" rx="1.5" />
      <path d="M15.7 18.5v1.5M19.7 18.5v1.5M15 20h5.4" />
    </svg>
  )
}
