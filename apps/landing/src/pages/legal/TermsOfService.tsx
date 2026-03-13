import content from "../../../legal/terms-of-services.md?raw";
import LegalPage from "../LegalPage";

export default function TermsOfService() {
  return (
    <LegalPage
      content={content}
      title="Terms of Service"
      description="Review the Pictobook terms of service for use of the website, waitlist, and future product offerings."
      path="/legal/terms-of-service"
    />
  );
}
