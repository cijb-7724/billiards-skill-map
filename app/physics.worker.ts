import { simulateBrowserShot, type SimulationRequest } from "./physics";

self.onmessage = (event: MessageEvent<SimulationRequest>) => {
  const request = event.data;
  const shot = simulateBrowserShot(request);
  self.postMessage({ requestId: request.requestId, shot });
};
