// @ts-nocheck

export default function createMachine(stateMachineDefinition) {
  const machine = {
    value: stateMachineDefinition.initialState,
    transition(currentState, event) {
      const currentStateDefinition = stateMachineDefinition[currentState]
      const destinationTransition = currentStateDefinition.transitions[event]
      if (!destinationTransition) {
        return
      }
      const destinationState = destinationTransition.target
      const destinationStateDefinition =
        stateMachineDefinition[destinationState]

      const transitionAccepted = destinationTransition.action()
      if (!transitionAccepted) {
        return machine.value;
      }
      currentStateDefinition.actions.onExit()
      destinationStateDefinition.actions.onEnter()
      machine.value = destinationState

      return machine.value
    },
  }
  return machine
}
