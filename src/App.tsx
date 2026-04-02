import React, { useState, useEffect } from "react";
import { ChatScreen } from "./screens";
import { OnboardingScreen } from "./screens";
import { MeetingDetectionBanner } from "./components/MeetingDetectionBanner";

export const App: React.FC = () => {
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);

  useEffect(() => {
    const onboardingCompleted = localStorage.getItem("onboardingCompleted");
    if (onboardingCompleted) {
      setHasCompletedOnboarding(true);
    }
  }, []);

  const completeOnboarding = () => {
    setHasCompletedOnboarding(true);
    localStorage.setItem("onboardingCompleted", "true");
  };

  if (!hasCompletedOnboarding) {
    return <OnboardingScreen onComplete={completeOnboarding} />;
  }

  return (
    <>
      <MeetingDetectionBanner />
      <ChatScreen />
    </>
  );
};
