import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { RootLayout } from './root-layout'

const fixture = vi.hoisted(() => ({ pathname: '' }))
vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useRouterState: ({ select }: { select: (state: { location: typeof fixture }) => string }) =>
    select({ location: fixture }),
  Outlet: () => 'board outlet',
}))
vi.mock('@/features/signin/hooks/auth', () => ({
  useAuth: () => { throw new Error('legacy auth mounted') },
}))
vi.mock('@/components/theme-provider', () => ({ ThemeProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/features/board/style-provider', () => ({ StyleDefaultsProvider: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }))
vi.mock('@/components/sidebar/app-sidebar', () => ({ AppSidebar: () => null }))
vi.mock('@/components/sidebar/sidebar-label', () => ({ SidebarLabel: () => null }))

afterEach(() => vi.unstubAllEnvs())

it.each(['/signin', '/signup', '/share/join/example', '/boards', '/boards/', '/boards/example', '/boards/example/sheets/1', '/jazz-signin', '/jazz-signin/', '/jazz-invite/example'])(
  'renders %s without initializing legacy auth in Jazz mode', (pathname) => {
    vi.stubEnv('VITE_DIM0_JAZZ_CANVAS', '1')
    fixture.pathname = pathname
    expect(renderToStaticMarkup(<RootLayout />)).toContain('board outlet')
  },
)

it.each([['1', '/local/example'], ['1', '/boards-archive'], ['0', '/boards/example']])(
  'preserves the legacy root for flag %s and path %s', (flag, pathname) => {
    vi.stubEnv('VITE_DIM0_JAZZ_CANVAS', flag)
    fixture.pathname = pathname
    expect(() => renderToStaticMarkup(<RootLayout />)).toThrow('legacy auth mounted')
  },
)
