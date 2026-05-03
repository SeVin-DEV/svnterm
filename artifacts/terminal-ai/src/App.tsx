import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import MainPage from "@/pages/main";
import ConnectionsPage from "@/pages/connections";
import SnippetsPage from "@/pages/snippets";
import SettingsPage from "@/pages/settings";
import FilesPage from "@/pages/files";
import Layout from "@/components/layout";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5000 },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={MainPage} />
        <Route path="/connections" component={ConnectionsPage} />
        <Route path="/files" component={FilesPage} />
        <Route path="/snippets" component={SnippetsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
