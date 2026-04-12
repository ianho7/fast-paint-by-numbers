declare module "../generated/pbn_core.js" {
  export default function init(input?: URL | RequestInfo | ArrayBuffer | Uint8Array): Promise<void>;
  export function process_rgba_json(inputJson: string): string;
}
