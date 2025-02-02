import { expect } from 'chai';
import { ethers } from 'hardhat';

import { error } from '@hyperlane-xyz/utils';

import { TestChains } from '../consts/chains';
import { TestCoreApp } from '../core/TestCoreApp';
import { TestCoreDeployer } from '../core/TestCoreDeployer';
import { HyperlaneProxyFactoryDeployer } from '../deploy/HyperlaneProxyFactoryDeployer';
import { MultiProvider } from '../providers/MultiProvider';
import { randomAddress, randomInt } from '../test/testUtils';

import {
  HyperlaneIsmFactory,
  moduleMatchesConfig,
} from './HyperlaneIsmFactory';
import {
  AggregationIsmConfig,
  IsmConfig,
  IsmType,
  ModuleType,
  MultisigIsmConfig,
  RoutingIsmConfig,
} from './types';

function randomModuleType(): ModuleType {
  const choices = [
    ModuleType.AGGREGATION,
    ModuleType.MERKLE_ROOT_MULTISIG,
    ModuleType.ROUTING,
  ];
  return choices[randomInt(choices.length)];
}

const randomMultisigIsmConfig = (m: number, n: number): MultisigIsmConfig => {
  const emptyArray = new Array<number>(n).fill(0);
  const validators = emptyArray.map(() => randomAddress());
  return {
    type: IsmType.MERKLE_ROOT_MULTISIG,
    validators,
    threshold: m,
  };
};

const randomIsmConfig = (depth = 0, maxDepth = 2): IsmConfig => {
  const moduleType =
    depth == maxDepth ? ModuleType.MERKLE_ROOT_MULTISIG : randomModuleType();
  if (moduleType === ModuleType.MERKLE_ROOT_MULTISIG) {
    const n = randomInt(5, 1);
    return randomMultisigIsmConfig(randomInt(n, 1), n);
  } else if (moduleType === ModuleType.ROUTING) {
    const config: RoutingIsmConfig = {
      type: IsmType.ROUTING,
      owner: randomAddress(),
      domains: Object.fromEntries(
        TestChains.map((c) => [c, randomIsmConfig(depth + 1)]),
      ),
    };
    return config;
  } else if (moduleType === ModuleType.AGGREGATION) {
    const n = randomInt(5, 1);
    const modules = new Array<number>(n)
      .fill(0)
      .map(() => randomIsmConfig(depth + 1));
    const config: AggregationIsmConfig = {
      type: IsmType.AGGREGATION,
      threshold: randomInt(n, 1),
      modules,
    };
    return config;
  } else {
    throw new Error(`Unsupported ISM type: ${moduleType}`);
  }
};

describe('HyperlaneIsmFactory', async () => {
  let ismFactory: HyperlaneIsmFactory;
  let coreApp: TestCoreApp;

  const chain = 'test1';

  before(async () => {
    const [signer] = await ethers.getSigners();

    const multiProvider = MultiProvider.createTestMultiProvider({ signer });

    const ismFactoryDeployer = new HyperlaneProxyFactoryDeployer(multiProvider);
    ismFactory = new HyperlaneIsmFactory(
      await ismFactoryDeployer.deploy(multiProvider.mapKnownChains(() => ({}))),
      multiProvider,
    );
    const coreDeployer = new TestCoreDeployer(multiProvider, ismFactory);
    coreApp = await coreDeployer.deployApp();
  });

  it('deploys a simple ism', async () => {
    const config = randomMultisigIsmConfig(3, 5);
    const ism = await ismFactory.deploy({ destination: chain, config });
    const matches = await moduleMatchesConfig(
      chain,
      ism.address,
      config,
      ismFactory.multiProvider,
      ismFactory.getContracts(chain),
    );
    expect(matches).to.be.true;
  });

  for (let i = 0; i < 16; i++) {
    it('deploys a random ism config', async () => {
      const config = randomIsmConfig();
      let ismAddress: string;
      try {
        const ism = await ismFactory.deploy({ destination: chain, config });
        ismAddress = ism.address;
      } catch (e) {
        error('Failed to deploy random ism config', e);
        error(JSON.stringify(config, null, 2));
        process.exit(1);
      }

      try {
        const matches = await moduleMatchesConfig(
          chain,
          ismAddress,
          config,
          ismFactory.multiProvider,
          ismFactory.getContracts(chain),
        );
        expect(matches).to.be.true;
      } catch (e) {
        error('Failed to match random ism config', e);
        error(JSON.stringify(config, null, 2));
        process.exit(1);
      }
    });
  }

  it('deploys routingIsm with correct routes', async () => {
    const config: RoutingIsmConfig = {
      type: IsmType.ROUTING,
      owner: randomAddress(),
      domains: Object.fromEntries(
        TestChains.map((c) => [c, randomIsmConfig()]),
      ),
    };
    const ism = await ismFactory.deploy({ destination: chain, config });
    const matches = await moduleMatchesConfig(
      chain,
      ism.address,
      config,
      ismFactory.multiProvider,
      ismFactory.getContracts(chain),
    );
    expect(matches).to.be.true;
  });

  it('deploys defaultFallbackRoutingIsm with correct routes and fallback to mailbox', async () => {
    const config: RoutingIsmConfig = {
      type: IsmType.FALLBACK_ROUTING,
      owner: randomAddress(),
      domains: Object.fromEntries(
        TestChains.map((c) => [c, randomIsmConfig()]),
      ),
    };
    const mailbox = await coreApp.getContracts(chain).mailbox;
    const ism = await ismFactory.deploy({
      destination: chain,
      config,
      mailbox: mailbox.address,
    }); // not through an actual factory just for maintaining consistency in naming
    const matches = await moduleMatchesConfig(
      chain,
      ism.address,
      config,
      ismFactory.multiProvider,
      ismFactory.getContracts(chain),
      mailbox.address,
    );
    expect(matches).to.be.true;
  });
});
