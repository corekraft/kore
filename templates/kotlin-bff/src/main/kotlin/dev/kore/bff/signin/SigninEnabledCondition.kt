package dev.kore.bff.signin

import org.springframework.context.annotation.Condition
import org.springframework.context.annotation.ConditionContext
import org.springframework.core.type.AnnotatedTypeMetadata

/** Matches when golden-path-signin is on, by the same rule SigninSettings applies. */
class SigninEnabledCondition : Condition {
    override fun matches(context: ConditionContext, metadata: AnnotatedTypeMetadata): Boolean =
        SigninSettings.from { context.environment.getProperty(it) } is SigninSettings.Enabled
}
