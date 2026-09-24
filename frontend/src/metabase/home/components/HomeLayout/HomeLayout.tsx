import type { ReactNode } from "react";
import { useState } from "react";
import { t } from "ttag";

import { LighthouseIllustration } from "metabase/common/components/LighthouseIllustration";
import { useHasTokenFeature } from "metabase/common/hooks";
import { getUser, getUserIsAdmin } from "metabase/current-user";
import { useSelector } from "metabase/redux";
import { getLandingPageIllustration } from "metabase/selectors/whitelabel";
import { useSetting } from "metabase/settings";
import { Box, Button, Icon, Tooltip } from "metabase/ui";

import { CustomHomePageModal } from "../CustomHomePageModal";
import { HomeGreeting } from "../HomeGreeting";
import { SetupGuideHomePage } from "../SetupGuideHomePage";

interface HomeLayoutProps {
  children?: ReactNode;
}

export const HomeLayout = ({ children }: HomeLayoutProps): ReactNode => {
  const [showModal, setShowModal] = useState(false);
  const isAdmin = useSelector(getUserIsAdmin);
  const landingPageIllustration = useSelector(getLandingPageIllustration);

  const user = useSelector(getUser);
  const embeddingHomepage = useSetting("embedding-homepage");
  const isSimpleEmbeddingAvailable = useHasTokenFeature("embedding_simple");

  if (
    embeddingHomepage === "visible" &&
    user?.is_superuser &&
    isSimpleEmbeddingAvailable
  ) {
    return <SetupGuideHomePage />;
  }

  return (
    <Box
      data-testid="home-page"
      pos="relative"
      p={{
        base: "1rem",
        md: "3rem 4rem",
        lg: "4rem 7rem 2rem",
        xl: "6rem 12rem 4rem",
      }}
      mih="100%"
      bg="background_page-secondary"
      style={{
        backgroundImage:
          "radial-gradient(1200px 650px at 15% -10%, color-mix(in srgb, var(--mb-color-core-brand) 13%, transparent), transparent 70%), radial-gradient(800px 450px at 85% 15%, rgba(99, 102, 241, 0.07), transparent 60%), radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--mb-color-text-primary) 3.5%, transparent) 1px, transparent 0)",
        backgroundSize: "100% 100%, 100% 100%, 28px 28px",
      }}
    >
      {landingPageIllustration &&
        (landingPageIllustration.isDefault ? (
          <LighthouseIllustration />
        ) : (
          <Box
            data-testid="landing-page-illustration"
            pos="absolute"
            inset={0}
            bgsz="100% auto"
            bgr="no-repeat"
            bgp="bottom"
            style={{
              backgroundImage: `url(${landingPageIllustration.src})`,
            }}
          />
        ))}
      <HomeGreeting />
      {isAdmin && (
        <Tooltip label={t`Pick a dashboard to serve as the homepage`}>
          <Button
            pos="absolute"
            top="0.75rem"
            right="1rem"
            variant="subtle"
            leftSection={<Icon name="pencil" />}
            onClick={() => setShowModal(true)}
          >
            {t`Customize`}
          </Button>
        </Tooltip>
      )}
      <Box
        pos="relative"
        mt={{
          base: "2.5rem",
          md: "3.5rem",
          lg: "4.5rem",
        }}
      >
        {children}
      </Box>
      <CustomHomePageModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
      />
    </Box>
  );
};
