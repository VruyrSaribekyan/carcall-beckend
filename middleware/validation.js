const { body, validationResult } = require('express-validator');

const validateRegistration = [
    body('email').isEmail().withMessage('Некорректный Email'),
    body('password').isLength({ min: 6 }).withMessage('Пароль минимум 6 символов'),
    body('passwordConfirm').custom((value, { req }) => {
        if (value !== req.body.password) {
            throw new Error('Пароли не совпадают');
        }
        return true;
    }),
    body('firstName').notEmpty().withMessage('Имя обязательно'),
    body('lastName').notEmpty().withMessage('Фамилия обязательна'),
    body('age').isInt({ min: 18 }).withMessage('Вам должно быть 18+'),
    body('carNumber').notEmpty().withMessage('Номер машины обязателен'),
    (req, res, next) => {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        next();
    }
];

module.exports = { validateRegistration };