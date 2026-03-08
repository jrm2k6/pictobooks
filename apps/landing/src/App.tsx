import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import AcceptableUse from "./pages/legal/AcceptableUse";
import Cookies from "./pages/legal/Cookies";
import Dmca from "./pages/legal/Dmca";
import PrivacyPolicy from "./pages/legal/PrivacyPolicy";
import Refunds from "./pages/legal/Refunds";
import TermsOfService from "./pages/legal/TermsOfService";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/legal/privacy-policy"} component={PrivacyPolicy} />
      <Route path={"/legal/terms-of-service"} component={TermsOfService} />
      <Route path={"/legal/cookies"} component={Cookies} />
      <Route path={"/legal/refunds"} component={Refunds} />
      <Route path={"/legal/dmca"} component={Dmca} />
      <Route path={"/legal/acceptable-use"} component={AcceptableUse} />
      <Route path={"/404"} component={NotFound} />
      {/* Final fallback route */}
      <Route component={NotFound} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
