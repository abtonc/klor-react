import type { ReactNode } from 'react'

export const metadata = {
  title: 'Klor integration example',
  description: 'Exercises every capability of @klor/react from a Next.js app.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          background: '#0b0a0f',
          color: '#edebf2',
          margin: 0,
          padding: '2rem',
          lineHeight: 1.6,
        }}
      >
        {children}
      </body>
    </html>
  )
}
