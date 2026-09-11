export type ProjectBible = {
  project: {
    title: string
    logline: string
    genre: string
    visualStyle: string
    aspectRatio: string
  }
  character: {
    name: string
    role: string
    appearance: string
    costume: string
    personality: string
    characterPrompt: string
  }
  environment: {
    location: string
    architecture: string
    lighting: string
    weather: string
    environmentPrompt: string
  }
  cinematography: {
    lenses: string[]
    cameraLanguage: string
    lightingLanguage: string
    colorPalette: string[]
  }
  shots: Array<{
    id: string
    title: string
    duration: number
    framing: string
    lens: string
    cameraMotion: string
    action: string
    imagePrompt: string
    videoPrompt: string
  }>
}
