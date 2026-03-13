import content from "../../../legal/privacy-policy.md?raw";
import LegalPage from "../LegalPage";

export default function PrivacyPolicy() {
  return (
    <LegalPage
      content={content}
      title="Privacy Policy"
      description="Read the Pictobook privacy policy for details about data collection, email signup handling, and your rights."
      path="/legal/privacy-policy"
    />
  );
}
