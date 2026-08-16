import { calibrateToReference, simulateBrowserShot, type SimulationRequest } from "./physics";

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const request = event.data;
  const changed = simulateBrowserShot(request);
  const shot = request.baselineCue && request.referenceShot
    ? calibrateToReference(
      changed,
      simulateBrowserShot({ ...request, cue: request.baselineCue, baselineCue: undefined, referenceShot: undefined }),
      request.referenceShot,
      request.cue,
      request.baselineCue,
    )
    : changed;
  self.postMessage({ requestId: request.requestId, shot });
};
