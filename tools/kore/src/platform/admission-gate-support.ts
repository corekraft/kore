/** The generated constraint CRD of the KoreApplicationAdmission template, as fakes return it. */
export function gateCrdJson(declared: readonly string[]): string {
  return JSON.stringify({
    spec: {
      versions: [
        {
          name: "v1beta1",
          schema: {
            openAPIV3Schema: {
              properties: {
                spec: {
                  properties: {
                    parameters: {
                      properties: Object.fromEntries(
                        declared.map((name) => [name, {}]),
                      ),
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  });
}

export const currentGateParameters = [
  "generation",
  "state",
  "platformNamespaces",
  "bootstrapGroups",
  "controllerIdentities",
];
