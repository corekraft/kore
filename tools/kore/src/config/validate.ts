import { registryAddressErrors } from "./registry-address.js";
import { policyErrors } from "./policy-validation.js";
    ...providerCrdGroupErrors(
      environment.provider,
      environment.providerOwnedCRDGroups,
      components,
    ),
    ...catalogErrors(components),
    ...dependencyErrors(components, names),
    ...(await overlayErrors(repository)),
    ...cycleErrors(catalog),
    ...(await imageListErrors(repository)),
    ...(await policyErrors(repository)),
    ...readinessErrors(repository),
    ...registryAddressErrors(repository),
  ];
  if (errors.length) {
    throw new Error([...new Set(errors)].sort().join("\n"));
  }
}
