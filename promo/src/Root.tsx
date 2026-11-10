import { Composition } from "remotion";
import { Intro, INTRO_FRAMES } from "./Intro";

export const Root = () => (
  <>
    <Composition id="intro-zh" component={Intro} durationInFrames={INTRO_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ lang: "zh" as const }} />
    <Composition id="intro-en" component={Intro} durationInFrames={INTRO_FRAMES} fps={30} width={1920} height={1080} defaultProps={{ lang: "en" as const }} />
  </>
);
