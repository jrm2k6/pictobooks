import content from "../../../legal/cookies.md?raw";
import LegalPage from "../LegalPage";

export default function Cookies() {
  return (
    <LegalPage
      content={content}
      title="Cookie Policy"
      description="See how Pictobook uses cookies and similar technologies across the landing page and waitlist experience."
      path="/legal/cookies"
    />
  );
}
