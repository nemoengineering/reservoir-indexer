type ConfigOptions = {
  aggregatorSource?: string;
  addresses?: {
    [namespace: string]: {
      [type: string]: {
        [chainId: number]: string | string[];
      };
    };
  };
};

// Should be overridden for custom configuration
export const Config: ConfigOptions = {
  aggregatorSource: undefined,
  addresses: undefined,
};
