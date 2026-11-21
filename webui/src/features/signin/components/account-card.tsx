import type { ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"


/** Shared Dim0 account surface for each configured authentication method. */
export function AccountCard({ mode, children }: { mode: "signin" | "signup"; children: ReactNode }) {
  return (
    <div className="w-full max-w-md mx-auto">
      <Card className="bg-card text-card-foreground border border-border shadow-xl">
        <CardHeader className="text-center">
          <CardTitle className={mode === "signin" ? "text-2xl flex flex-col items-center justify-center gap-2" : "text-2xl"}>
            {mode === "signin" ? <>
              <img src="/dim0.svg" alt="Dim0 Logo" className="h-12 w-12 aspect-square object-contain" />
              <span className="text-muted-foreground">Welcome back!</span>
            </> : "Create your account"}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {mode === "signin" ? "Sign in to continue to your workspace" : "Start organizing your chats and boards"}
          </CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}
