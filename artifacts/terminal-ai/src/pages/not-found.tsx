import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Terminal } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4">
      <Terminal className="w-10 h-10 text-muted-foreground opacity-30" />
      <div className="text-center">
        <h1 className="text-lg font-mono font-semibold text-foreground">404</h1>
        <p className="text-sm text-muted-foreground mt-1">Page not found</p>
      </div>
      <Link href="/">
        <Button variant="outline" size="sm">Go to Terminal</Button>
      </Link>
    </div>
  );
}
