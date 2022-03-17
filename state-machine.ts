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
        console.log('transition not accepted');
        return machine.value;
      }
      currentStateDefinition.actions.onExit()
      destinationStateDefinition.actions.onEnter()
      machine.value = destinationState
      console.log('new machine value = ', {currentState, event, destinationState, value: machine.value});

      return machine.value
    },
  }
  return machine
}
