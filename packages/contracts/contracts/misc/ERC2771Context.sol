// SPDX-License-Identifier: MIT

pragma solidity ^0.8.1;

// Based on https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/metatx/ERC2771Context.sol
abstract contract ERC2771Context {
  mapping(address => bool) private _trustedForwarders;

  function isTrustedForwarder(address forwarder) public view virtual returns (bool) {
    return _trustedForwarders[forwarder];
  }

  function _addForwarder(address forwarder) internal {
    _trustedForwarders[forwarder] = true;
  }

  function _removeForwarder(address forwarder) internal {
    _trustedForwarders[forwarder] = false;
  }

  function _msgSender() internal view virtual returns (address sender) {
    if (isTrustedForwarder(msg.sender)) {
      // The assembly code is more direct than the Solidity version using `abi.decode`
      assembly {
        sender := shr(96, calldataload(sub(calldatasize(), 20)))
      }
    } else {
      return msg.sender;
    }
  }

  function _msgData() internal view virtual returns (bytes calldata) {
    if (isTrustedForwarder(msg.sender)) {
      return msg.data[:msg.data.length - 20];
    } else {
      return msg.data;
    }
  }
}
