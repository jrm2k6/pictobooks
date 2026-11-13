import type {
  ImageArtifactResult,
  ImageOperationInput,
  ImageProcessor,
} from "./bookRun.js";

const SCHEMA_VERSION = "2026-11-08";

export class ContainerImageProcessor implements ImageProcessor {
  constructor(private readonly containers: Env["IMAGE_CONTAINER"]) {}

  normalize(input: ImageOperationInput): Promise<ImageArtifactResult> {
    return this.invoke("normalize", input);
  }

  cleanup(input: ImageOperationInput): Promise<ImageArtifactResult> {
    return this.invoke("cleanup", input);
  }

  printQa(input: ImageOperationInput): Promise<ImageArtifactResult> {
    return this.invoke("print-qa", input);
  }

  private async invoke(
    operation: "normalize" | "cleanup" | "print-qa",
    input: ImageOperationInput
  ): Promise<ImageArtifactResult> {
    const container = this.containers.getByName(`page-${input.pageId}`);
    const response = await container.fetch(
      `http://container/v1/operations/${operation}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schemaVersion: SCHEMA_VERSION,
          operationId: input.operationId,
          input: input.input,
          output: input.output,
        }),
        signal: AbortSignal.timeout(90_000),
      }
    );
    if (!response.ok) {
      throw new Error(
        `Image Container ${operation} failed with status ${response.status}`
      );
    }
    const result = await response.json<ImageArtifactResult>();
    if (
      result.operationId !== input.operationId ||
      result.artifact.artifactId !== input.output.artifactId ||
      result.artifact.objectKey !== input.output.objectKey ||
      result.artifact.sourceArtifactId !== input.input.artifactId
    ) {
      throw new Error(
        `Image Container ${operation} returned mismatched metadata`
      );
    }
    return result;
  }
}
