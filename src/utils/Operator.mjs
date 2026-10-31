import _ from 'lodash'

const Operator = (network, data) => {
  const { address } = data
  const botAddress = network.data.operator?.address || data.restake.address
  const minimumReward = network.data.operator?.minimumReward || data.restake.minimum_reward

  const validator = network.validators?.find(v => (v.operator_address === address || v.address === address))
  const moniker = data.moniker || data.description?.moniker || validator?.description?.moniker || validator?.moniker

  return {
    address,
    botAddress,
    minimumReward,
    moniker,
    description: data.description || validator?.description,
    data,
  }
}

export default Operator;
