import './globals.css'

export const metadata = {
  title: 'AI Film Studio',
  description: 'Idea → Character → Concept → Storyboard → Video'
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  )
}
